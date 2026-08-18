<?php

namespace App\Service;

use Symfony\Contracts\HttpClient\HttpClientInterface;

class VelibApiService
{
    private const STATUS_URL =
        'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_status.json';

    private const INFO_URL =
        'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_information.json';


    public function __construct(
        private HttpClientInterface $httpClient
    ) {
    }

    private function getRentalStatus(int $bikes): string
    {
        if ($bikes === 0) {
            return 'Indisponible';
        }

        if ($bikes <= 3) {
            return 'Quelques vélos';
        }

        return 'Disponible';
    }

    private function getReturnStatus(int $docks): string
    {
        if ($docks === 0) {
            return 'Impossible';
        }

        if ($docks <= 5) {
            return 'Peu de places';
        }

        return 'Places disponibles';
    }

    public function getStations(): array
    {
        $status = $this->httpClient
            ->request('GET', self::STATUS_URL)
            ->toArray();


        $information = $this->httpClient
            ->request('GET', self::INFO_URL)
            ->toArray();


        $stationsInfo = [];

        foreach ($information['data']['stations'] as $station) {
            $stationsInfo[$station['station_id']] = $station;
        }


        $stations = [];

        

        foreach ($status['data']['stations'] as $station) {


            $mechanicalBikes = 0;
            $electricBikes = 0;

            foreach ($station['num_bikes_available_types'] as $type) {

                if (isset($type['mechanical'])) {
                    $mechanicalBikes = $type['mechanical'];
                }

                if (isset($type['ebike'])) {
                    $electricBikes = $type['ebike'];
                }
            }

            $id = $station['station_id'];

            $stations[] = [
                'id' => $station['station_id'],
                'name' => $stationsInfo[$id]['name'] ?? 'Station inconnue',
                'address' => $stationsInfo[$id]['address'] ?? '',
                'latitude' => $stationsInfo[$id]['lat'] ?? null,
                'longitude' => $stationsInfo[$id]['lon'] ?? null,
                'capacity' => $stationsInfo[$id]['capacity'] ?? 0,
                'bikes' => $station['num_bikes_available'],
                'mechanicalBikes' => $mechanicalBikes,
                'electricBikes' => $electricBikes,
                'docks' => $station['num_docks_available'],
                'rentalStatus' => $this->getRentalStatus(
                    $station['num_bikes_available']
                ),
                'returnStatus' => $this->getReturnStatus(
                    $station['num_docks_available']
                ),
            ];

            
        }
        

        return $stations;
    }
}


