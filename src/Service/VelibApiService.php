<?php

namespace App\Service;

class VelibApiService
{
    public function getStations(): array
    {
        return [
            [
                'name' => 'Gare de Lyon',
                'bikes' => 12,
                'stands' => 8,
            ],
            [
                'name' => 'Bastille',
                'bikes' => 5,
                'stands' => 15,
            ],
        ];
    }
}
