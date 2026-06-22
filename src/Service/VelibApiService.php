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

            $id = $station['station_id'];

            $stations[] = [
                'name' => $stationsInfo[$id]['name'] ?? 'Station inconnue',
                'address' => $stationsInfo[$id]['address'] ?? '',
                'latitude' => $stationsInfo[$id]['lat'] ?? null,
                'longitude' => $stationsInfo[$id]['lon'] ?? null,

                'bikes' => $station['num_bikes_available'],
                'docks' => $station['num_docks_available'],
            ];
        }


        return array_slice($stations, 0, 20);
    }
}


