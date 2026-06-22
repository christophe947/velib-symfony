<?php

namespace App\Service;

use Symfony\Contracts\HttpClient\HttpClientInterface;

class VelibApiService
{
    public function __construct(
        private HttpClientInterface $httpClient
    ) {
    }

    public function getStations(): array
    {
        $response = $this->httpClient->request(
            'GET',
            'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_status.json'
        );

        $data = $response->toArray();

        return array_slice(
            $data['data']['stations'],
            0,
            20
        );
    }
}

